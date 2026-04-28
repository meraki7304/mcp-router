use std::sync::Arc;

use rmcp::{
    handler::server::ServerHandler,
    model::{
        CallToolRequestParams, CallToolResult, Implementation, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo,
    },
    service::RequestContext,
    ErrorData as McpError, RoleServer,
};

use crate::{
    mcp::server_manager::ServerManager,
    shared_config::store::SharedConfigStore,
};

/// MCP server that aggregates tools from all servers managed by `ServerManager`.
///
/// Plan 7b: real aggregation. `list_tools` walks every running server and merges their
/// tools, prefixing names with `<server-name>__`. `call_tool` parses the prefix and
/// routes to the right backend server.
///
/// Per-token ACL (filtering by `Token.serverAccess`) is deferred to Plan 7c.
#[derive(Clone)]
pub struct Aggregator {
    pub server_manager: Arc<ServerManager>,
    #[allow(dead_code)] // used in Plan 7c for per-token ACL
    pub shared_config: Arc<SharedConfigStore>,
}

impl Aggregator {
    pub fn new(
        server_manager: Arc<ServerManager>,
        shared_config: Arc<SharedConfigStore>,
    ) -> Self {
        Self {
            server_manager,
            shared_config,
        }
    }
}

impl ServerHandler for Aggregator {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_protocol_version(ProtocolVersion::V_2025_03_26)
            .with_server_info(
                Implementation::new("mcp-router-aggregator", env!("CARGO_PKG_VERSION"))
                    .with_title("MCP Router"),
            )
            .with_instructions(
                "MCP Router aggregates tools across configured local servers. \
                 Tool names are prefixed with `<server-name>__` so callers can identify the \
                 backing server. Plan 7c will add per-token server-access filtering.",
            )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let running = self
            .server_manager
            .running_servers()
            .await
            .map_err(|e| McpError::internal_error(format!("running_servers: {e}"), None))?;

        let mut all = Vec::new();
        for info in running {
            // Per-server failures don't kill the whole list — log + skip.
            let tools = match self.server_manager.list_tools_typed(&info.id).await {
                Ok(t) => t,
                Err(e) => {
                    tracing::warn!(server_id = %info.id, error = %e, "list_tools_typed failed; skipping server");
                    continue;
                }
            };
            for mut tool in tools {
                tool.name = std::borrow::Cow::Owned(format!("{}__{}", info.name, tool.name));
                all.push(tool);
            }
        }

        Ok(ListToolsResult::with_all_items(all))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let (server_name, tool_name) = request.name.split_once("__").ok_or_else(|| {
            McpError::invalid_request(
                format!(
                    "tool name '{}' is not in '<server-name>__<tool-name>' form",
                    request.name
                ),
                None,
            )
        })?;

        let running = self
            .server_manager
            .running_servers()
            .await
            .map_err(|e| McpError::internal_error(format!("running_servers: {e}"), None))?;

        let info = running
            .iter()
            .find(|i| i.name == server_name)
            .ok_or_else(|| {
                McpError::invalid_request(
                    format!("server '{server_name}' is not running"),
                    None,
                )
            })?;

        self.server_manager
            .call_tool_typed(&info.id, tool_name, request.arguments)
            .await
            .map_err(|e| {
                McpError::internal_error(format!("call_tool '{tool_name}': {e}"), None)
            })
    }
}
