// Vapi server-message dispatcher (POST /api/vapi/webhook).
//
// This is the boundary between the telephony platform and our application:
// it only translates Vapi's message envelope into tool-handler / call-log
// calls. Conversation logic lives in the prompt; business rules live in the
// service layer.
//
// Vapi contract (https://docs.vapi.ai/tools/custom-tools):
//   request:  { message: { type: "tool-calls", toolCallList: [{ id, function: { name, arguments } }], call } }
//   response: HTTP 200 { results: [{ toolCallId, result: "<string>" }] }
// Vapi ignores non-200 responses, so tool failures are reported inside `result`.

export function createVapiWebhookHandler({ toolHandlers, callLogService, logger }) {
  async function runToolCall(toolCall, ctx) {
    const name = toolCall.function?.name ?? toolCall.name;
    const args = parseArguments(toolCall.function?.arguments ?? toolCall.arguments);
    const handler = Object.hasOwn(toolHandlers, name) ? toolHandlers[name] : null;
    const started = Date.now();

    const result = handler
      ? await handler(args, ctx)
      : { success: false, error_type: 'unknown_tool', message: `Unknown tool "${name}".` };

    logger.info('voice.tool.call', { call_id: ctx.callId, tool: name, args, result, duration_ms: Date.now() - started });
    return { toolCallId: toolCall.id, result: JSON.stringify(result) };
  }

  async function handleToolCalls(message) {
    const ctx = callContext(message);
    const toolCalls = message.toolCallList ?? message.toolWithToolCallList?.map((t) => t.toolCall) ?? [];
    const results = await Promise.all(toolCalls.map((toolCall) => runToolCall(toolCall, ctx)));
    return { results };
  }

  async function handleEndOfCallReport(message) {
    const ctx = callContext(message);
    if (!ctx.callId) return { ok: true };
    const artifact = message.artifact ?? {};
    const startedAt = message.startedAt ?? message.call?.startedAt ?? null;
    const endedAt = message.endedAt ?? message.call?.endedAt ?? null;
    const duration =
      message.durationSeconds ?? (startedAt && endedAt ? (new Date(endedAt) - new Date(startedAt)) / 1000 : null);

    // Full conversation goes to stdout for observability, alongside the DB copy.
    logger.info('voice.call.transcript', { call_id: ctx.callId, ended_reason: message.endedReason, transcript: artifact.transcript });

    await callLogService.recordEndOfCall(ctx.callId, {
      caller_number: ctx.callerNumber ?? undefined,
      ended_reason: message.endedReason ?? null,
      summary: message.analysis?.summary ?? message.summary ?? null,
      transcript: artifact.transcript ?? null,
      recording_url: artifact.recording?.stereoUrl ?? artifact.recording?.mono?.combinedUrl ?? artifact.recordingUrl ?? null,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: duration,
    });
    return { ok: true };
  }

  return async function vapiWebhook(req, res) {
    const message = req.body?.message;
    if (!message?.type) {
      return res.status(400).json({ data: null, error: { code: 'bad_request', message: 'Expected a Vapi server message.' } });
    }

    switch (message.type) {
      case 'tool-calls':
        return res.json(await handleToolCalls(message));
      case 'end-of-call-report':
        try {
          return res.json(await handleEndOfCallReport(message));
        } catch (error) {
          // The call is already over; log loudly but acknowledge so Vapi doesn't retry forever.
          logger.error('voice.end_of_call.persist_failed', { call_id: message.call?.id, error });
          return res.json({ ok: false });
        }
      case 'status-update':
        logger.info('voice.call.status', { call_id: message.call?.id, status: message.status, ended_reason: message.endedReason });
        return res.json({ ok: true });
      default:
        logger.debug('voice.webhook.ignored', { type: message.type });
        return res.json({ ok: true });
    }
  };
}

function callContext(message) {
  return {
    callId: message.call?.id ?? null,
    callerNumber: message.call?.customer?.number ?? message.customer?.number ?? null,
  };
}

/** Vapi may deliver arguments as an object or a JSON string depending on the model provider. */
function parseArguments(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
