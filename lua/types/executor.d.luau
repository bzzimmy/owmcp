-- Executor (Opiumware) and owmcp globals used by lua/, for luau-lsp.
declare MCP_CALLBACK: string
declare MCP_SOURCE: string
declare MCP_RAW: boolean
-- Arguments that tools prepend to their Lua (decoded JSON).
declare ARGS: any

declare function getscripts(): { Instance }
declare function getscripthash(script: Instance): string?
declare function decompile(script: Instance): string

declare function request(options: { Url: string, Method: string?, Headers: { [string]: string }?, Body: string? }): { StatusCode: number, Body: string }
declare http_request: typeof(request)?
declare function getgenv(): { [any]: any }
