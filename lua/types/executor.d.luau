-- Executor (Opiumware) and owmcp globals used by lua/, for luau-lsp.
declare MCP_CALLBACK: string
declare MCP_SOURCE: string
declare MCP_RAW: boolean
-- Arguments that tools prepend to their Lua (decoded JSON).
declare ARGS: any

-- Provided by lua/runtime.luau to executed code.
declare function serialize(value: any, pretty: boolean?): string

declare function getscripts(): { Instance }
declare function hookmetamethod(object: any, method: string, hook: (...any) -> ...any): (...any) -> ...any
declare function newcclosure<T>(fn: T): T
declare function getnamecallmethod(): string
declare function checkcaller(): boolean
declare function getcallingscript(): Instance?
declare function getscripthash(script: Instance): string?
declare function decompile(script: Instance): string

declare function request(options: { Url: string, Method: string?, Headers: { [string]: string }?, Body: string? }): { StatusCode: number, Body: string }
declare http_request: typeof(request)?
declare function getgenv(): { [any]: any }
