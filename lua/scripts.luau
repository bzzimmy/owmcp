-- Lists the client's scripts and decompiles the requested ones. Run via runData with:
--   ARGS.decompile: "all" | "none" | <script path>
--   ARGS.known: { [hash]: true } (already decompiled on the server, skipped)

local known = ARGS.known
local scripts = {}

for index, script in getscripts() do
	local ok, hash = pcall(getscripthash, script)
	if not ok or not hash then
		continue -- no client bytecode (e.g. server Scripts)
	end

	local path = if script.Parent then script:GetFullName() else "nil." .. script:GetFullName()
	local entry = { path = path, class = script.ClassName, hash = hash }

	if (ARGS.decompile == "all" or ARGS.decompile == path) and not known[hash] then
		local decompiled, source = pcall(decompile, script)
		entry.source = if decompiled then source else "-- decompile failed: " .. tostring(source)
		known[hash] = true -- same bytecode (e.g. StarterPlayer templates) is only decompiled once
	end
	table.insert(scripts, entry)

	if index % 50 == 0 then
		task.wait() -- don't freeze the game on large script counts
	end
end

return { placeId = game.PlaceId, scripts = scripts }
