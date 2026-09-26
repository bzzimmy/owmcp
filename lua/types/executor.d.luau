-- Executor (Opiumware) and owmcp globals used by lua/, for luau-lsp.
declare MCP_CALLBACK: string
declare MCP_SOURCE: string

declare function request(options: { Url: string, Method: string?, Headers: { [string]: string }?, Body: string? }): { StatusCode: number, Body: string }
declare http_request: typeof(request)?
declare function getgenv(): { [any]: any }
