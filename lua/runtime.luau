--!nolint DeprecatedApi
-- (getfenv/setfenv are required to sandbox print/warn for executed code)
-- owmcp runtime. The bridge prepends:
--   local MCP_ID, MCP_CALLBACK, MCP_SOURCE, MCP_RAW = "<run id>", "<callback url>", "<user code>", <bool>
-- Runs in progress are registered in getgenv().__owmcp_runs[MCP_ID] so the bridge can cancel them on timeout.
-- Runs MCP_SOURCE, captures print/warn, serializes return values and POSTs the result to MCP_CALLBACK.
-- With MCP_RAW, the first return value is sent as-is (JSON) in `data` instead of being serialized for display.

local HttpService = game:GetService("HttpService")
local httpRequest = request or http_request

local MAX_DEPTH = 4
local MAX_ITEMS = 50
local INLINE_WIDTH = 80
local MAX_OUTPUT = 500

-- Readable text for any value. indent = "" for multi-line output, nil for a compact single line.
local function serialize(value, depth, seen, indent)
	local kind = typeof(value)

	if kind == "string" then
		return string.format("%q", value)
	elseif kind == "Instance" then
		return value:GetFullName() .. " (" .. value.ClassName .. ")"
	elseif kind == "function" then
		local name = debug.info(value, "n")
		return "function " .. (name ~= "" and name or "<anonymous>")
	elseif kind == "EnumItem" or kind == "nil" or kind == "number" or kind == "boolean" then
		return tostring(value)
	elseif kind ~= "table" then
		return kind .. "(" .. tostring(value) .. ")" -- Vector3(1, 2, 3), Color3(...), CFrame(...)
	end

	if seen[value] then return "<cycle>" end
	if depth >= MAX_DEPTH then return "{...}" end
	seen[value] = true

	local pad = if indent then indent .. "  " else nil
	local items, count, nextIndex = {}, 0, 1
	for key, item in pairs(value) do
		count += 1
		if count > MAX_ITEMS then continue end
		local prefix
		if key == nextIndex then
			prefix, nextIndex = "", nextIndex + 1
		elseif type(key) == "string" and key:match("^[%a_][%w_]*$") then
			prefix = key .. " = "
		else
			prefix = "[" .. serialize(key, depth + 1, seen, nil) .. "] = "
		end
		table.insert(items, prefix .. serialize(item, depth + 1, seen, pad))
	end
	if count > MAX_ITEMS then
		table.insert(items, "... " .. (count - MAX_ITEMS) .. " more")
	end

	seen[value] = nil
	if #items == 0 then return "{}" end
	-- Small tables stay on one line even in multi-line mode.
	local inline = "{" .. table.concat(items, ", ") .. "}"
	if not indent or (#inline <= INLINE_WIDTH and not inline:find("\n")) then return inline end
	return "{\n" .. pad .. table.concat(items, ",\n" .. pad) .. "\n" .. indent .. "}"
end

-- JSONEncode rejects strings that aren't valid UTF-8 (e.g. binary remote payloads), so escape their high bytes as \xNN.
local function jsonSafe(value)
	if type(value) == "string" then
		if utf8.len(value) then return value end
		return (value:gsub("[\128-\255]", function(byte)
			return string.format("\\x%02X", string.byte(byte))
		end))
	elseif type(value) == "table" then
		local copy = {}
		for key, item in value do
			copy[jsonSafe(key)] = jsonSafe(item)
		end
		return copy
	end
	return value
end

local function report(result)
	local ok, body = pcall(function()
		return HttpService:JSONEncode(jsonSafe(result))
	end)
	if not ok then
		body = HttpService:JSONEncode({ ok = false, returns = {}, output = {}, error = "Failed to encode result: " .. tostring(body) })
	end
	httpRequest({ Url = MCP_CALLBACK, Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = body })
end

-- print/warn go to the real console AND to every run currently in progress. Sinks are shared through getgenv,
-- so prints from code defined in earlier runs (e.g. a spawned loop's stop()) are captured by the current run too.
local sinks = getgenv().__owmcp_sinks or {}
getgenv().__owmcp_sinks = sinks
local sink = { lines = {}, dropped = 0 }

local function capture(label, original)
	return function(...)
		original(...)
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = tostring((select(i, ...)))
		end
		local line = label .. table.concat(parts, " ")
		for active in sinks do
			if #active.lines < MAX_OUTPUT then
				table.insert(active.lines, line)
			else
				active.dropped += 1
			end
		end
	end
end

-- Errors can be any value (error({code = 1})), so format them before building the traceback.
local function onError(err)
	local message = if type(err) == "string" then err else "error value: " .. serialize(err, 0, {}, nil)
	return debug.traceback(message, 2)
end

local env = setmetatable({
	print = capture("", print),
	warn = capture("[warn] ", warn),
	-- serialize(value, pretty?): the same readable text used for return values (compact single line by default).
	serialize = function(value, pretty)
		return serialize(value, 0, {}, if pretty then "" else nil)
	end,
}, { __index = getfenv(0) })

local fn, syntaxError = loadstring(MCP_SOURCE, "=mcp")
if not fn then
	report({ ok = false, returns = {}, output = {}, error = syntaxError })
	return
end
setfenv(fn, env)

local runs = getgenv().__owmcp_runs or {}
getgenv().__owmcp_runs = runs
runs[MCP_ID] = { thread = coroutine.running(), sink = sink }
sinks[sink] = true
local results = table.pack(xpcall(fn, onError))
sinks[sink] = nil
runs[MCP_ID] = nil

local output = sink.lines
if sink.dropped > 0 then
	table.insert(output, "... " .. sink.dropped .. " more lines not captured")
end

if not results[1] then
	-- Drop runtime-internal frames (chunk "Opiumware") from the traceback.
	local message = tostring(results[2]):gsub("Opiumware:%d+\n?", "")
	report({ ok = false, returns = {}, output = output, error = message })
	return
end

if MCP_RAW then
	report({ ok = true, returns = {}, output = output, data = results[2] })
	return
end

local returns = {}
for i = 2, results.n do
	returns[i - 1] = serialize(results[i], 0, {}, "")
end
report({ ok = true, returns = returns, output = output })
