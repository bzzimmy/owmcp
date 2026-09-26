--!nolint DeprecatedApi
-- (getfenv/setfenv are required to sandbox print/warn for executed code)
-- owmcp runtime. The bridge prepends:
--   local MCP_CALLBACK, MCP_SOURCE, MCP_RAW = "<callback url>", "<user code>", <bool>
-- Runs MCP_SOURCE, captures print/warn, serializes return values and POSTs the result to MCP_CALLBACK.
-- With MCP_RAW, the first return value is sent as-is (JSON) in `data` instead of being serialized for display.

local HttpService = game:GetService("HttpService")
local httpRequest = request or http_request

local MAX_DEPTH = 4
local MAX_ITEMS = 50
local MAX_OUTPUT = 500

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

	local pad = indent .. "  "
	local lines, count, nextIndex = {}, 0, 1
	for key, item in pairs(value) do
		count += 1
		if count > MAX_ITEMS then continue end
		local prefix
		if key == nextIndex then
			prefix, nextIndex = "", nextIndex + 1
		elseif type(key) == "string" and key:match("^[%a_][%w_]*$") then
			prefix = key .. " = "
		else
			prefix = "[" .. serialize(key, depth + 1, seen, pad) .. "] = "
		end
		table.insert(lines, pad .. prefix .. serialize(item, depth + 1, seen, pad))
	end
	if count > MAX_ITEMS then
		table.insert(lines, pad .. "-- ... " .. (count - MAX_ITEMS) .. " more")
	end

	seen[value] = nil
	if #lines == 0 then return "{}" end
	return "{\n" .. table.concat(lines, ",\n") .. "\n" .. indent .. "}"
end

local function report(result)
	local ok, body = pcall(HttpService.JSONEncode, HttpService, result)
	if not ok then
		body = HttpService:JSONEncode({ ok = false, returns = {}, output = {}, error = "Failed to encode result: " .. tostring(body) })
	end
	httpRequest({ Url = MCP_CALLBACK, Method = "POST", Headers = { ["Content-Type"] = "application/json" }, Body = body })
end

-- print/warn go to the real console AND are captured for the result.
local output, dropped = {}, 0
local function capture(label, original)
	return function(...)
		original(...)
		if #output >= MAX_OUTPUT then
			dropped += 1
			return
		end
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = tostring((select(i, ...)))
		end
		table.insert(output, label .. table.concat(parts, " "))
	end
end

local env = setmetatable({
	print = capture("", print),
	warn = capture("[warn] ", warn),
}, { __index = getfenv(0) })

local fn, syntaxError = loadstring(MCP_SOURCE, "=mcp")
if not fn then
	report({ ok = false, returns = {}, output = {}, error = syntaxError })
	return
end
setfenv(fn, env)

local results = table.pack(xpcall(fn, debug.traceback))
if dropped > 0 then
	table.insert(output, "... " .. dropped .. " more lines not captured")
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
