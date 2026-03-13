/**
 * Shared types for remote control MVP.
 * Used by both the WebSocket server and the frontend.
 */

export type RemoteCommand = "PLAY" | "PAUSE" | "LOAD_PLAYLIST";

export type ClientRole = "device" | "controller";

/** Message from client to server */
export type ClientMessage =
  | { type: "REGISTER"; role: ClientRole; deviceId?: string }
  | { type: "COMMAND"; targetDeviceId: string; command: RemoteCommand; payload?: { url?: string } };

/** Message from server to client */
export type ServerMessage =
  | { type: "REGISTERED"; deviceId?: string }
  | { type: "DEVICE_LIST"; devices: { id: string; connectedAt: string }[] }
  | { type: "COMMAND"; command: RemoteCommand; payload?: { url?: string } }
  | { type: "ERROR"; message: string };
