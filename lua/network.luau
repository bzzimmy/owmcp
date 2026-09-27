-- Remote traffic capture. Run via runData with ARGS.action = "start" | "stop" | "read".
-- Hooks exist only while capturing: start installs them, stop removes them. The log is kept in getgenv.

local MAX_ENTRIES = 5000
local REMOTE_EVENTS = { RemoteEvent = true, UnreliableRemoteEvent = true }

local state = getgenv().__owmcp_capture
if not state then
	state = { capturing = false, started = false, log = {}, dropped = 0, startedAt = 0, stoppedAt = 0 }
	getgenv().__owmcp_capture = state
end

-- Installs the hooks and returns a function that removes them again.
local function install(): () -> ()
	local toText = serialize -- captured as an upvalue: the hooks outlive this run

	local function argsText(...)
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = toText((select(i, ...)))
		end
		return table.concat(parts, ", ")
	end

	local function record(at, entry)
		if #state.log >= MAX_ENTRIES then
			table.remove(state.log, 1)
			state.dropped += 1
		end
		entry.time = at - state.startedAt
		table.insert(state.log, entry)
	end

	-- Outgoing: FireServer / InvokeServer from game scripts and the executor.
	local original
	original = hookmetamethod(
		game,
		"__namecall",
		newcclosure(function(self, ...)
			local method = getnamecallmethod()
			if not state.capturing or (method ~= "FireServer" and method ~= "InvokeServer") then
				return original(self, ...)
			end

			local at = os.clock()
			local fromExecutor = checkcaller()
			local caller = if fromExecutor then nil else getcallingscript()
			-- Forward before anything else: any namecall in here would overwrite the pending method.
			local results = table.pack(original(self, ...))

			pcall(function(...)
				record(at, {
					direction = "out",
					method = method,
					remote = self:GetFullName(),
					args = argsText(...),
					returned = if method == "InvokeServer" then argsText(table.unpack(results, 1, results.n)) else nil,
					caller = if fromExecutor then "executor" elseif caller then caller:GetFullName() else nil,
				})
			end, ...)
			return table.unpack(results, 1, results.n)
		end)
	)

	-- Incoming: OnClientEvent on every RemoteEvent, including ones created later.
	local connections = {}
	local function listen(instance)
		if not REMOTE_EVENTS[instance.ClassName] then return end
		table.insert(connections, instance.OnClientEvent:Connect(function(...)
			if state.capturing then
				pcall(record, os.clock(), { direction = "in", method = "OnClientEvent", remote = instance:GetFullName(), args = argsText(...) })
			end
		end))
	end
	for _, instance in game:GetDescendants() do
		listen(instance)
	end
	table.insert(connections, game.DescendantAdded:Connect(listen))

	return function()
		hookmetamethod(game, "__namecall", original)
		for _, connection in connections do
			connection:Disconnect()
		end
	end
end

local wasCapturing, previousCount = state.capturing, #state.log
if ARGS.action == "start" then
	state.log, state.dropped, state.startedAt = {}, 0, os.clock()
	state.capturing, state.started = true, true
	state.uninstall = state.uninstall or install()
elseif ARGS.action == "stop" and state.capturing then
	state.capturing, state.stoppedAt = false, os.clock()
	state.uninstall()
	state.uninstall = nil
end

return {
	started = state.started,
	capturing = state.capturing,
	elapsed = (if state.capturing then os.clock() else state.stoppedAt) - state.startedAt,
	dropped = state.dropped,
	count = #state.log,
	wasCapturing = wasCapturing,
	previousCount = previousCount,
	log = if ARGS.action == "read" then state.log else nil,
}
