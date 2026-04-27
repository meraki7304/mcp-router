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
/// Plan 7 ships a stub: `list_tools` returns empty, `call_tool` errors. Plan 7b wires real aggregation.
#[derive(Clone)]
pub struct Aggregator {
    #[allow(dead_code)] // used in Plan 7b
    pub server_manager: Arc<ServerManager>,
    #[allow(dead_code)] // available for future per-aggregation telemetry
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
        let server_info = Implementation::new("mcp-router-aggregator", env!("CARGO_PKG_VERSION"))
            .with_title("MCP Router");

        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_protocol_version(ProtocolVersion::V_2025_03_26)
            .with_server_info(server_info)
            .with_instructions(
                "MCP Router aggregates tools across configured servers. \
                 Plan 7 ships a stub (no tools); Plan 7b wires real aggregation.",
            )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        // Plan 7b: collect tools from each running ServerManager client and prefix names.
        Ok(ListToolsResult::with_all_items(vec![]))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        Err(McpError::invalid_request(
            format!(
                "tool '{}' not found — Plan 7 aggregator is a stub (Plan 7b adds routing)",
                request.name
            ),
            None,
        ))
    }
}
