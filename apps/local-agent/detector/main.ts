/**
 * Ventana del detector. En la fase 1 solo confirma que el agente sirve la página.
 *
 * Fase 2 (Juan, feat/agente-local-detector): crear SpellEngine y VoiceListener de
 * @duelo/spell-engine con los archivos de ./mediapipe, conectarse al WebSocket del mismo origen
 * (LOCAL_AGENT_EVENTS_PATH), mandar agent:hello con role "detector" y reenviar cada handler
 * como mensaje del protocolo de @duelo/contracts.
 */
import { LOCAL_AGENT_PROTOCOL_VERSION } from "@duelo/contracts";

const status = document.getElementById("status");
if (status) {
  status.textContent = `Agente en marcha (protocolo v${LOCAL_AGENT_PROTOCOL_VERSION}). El detector se conecta en la fase 2.`;
}
