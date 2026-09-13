import { startBroker, OAUTH_PROFILE_ID } from "./oauth-broker";
import { checkOAuthOwner } from "./oauth-owner";
// Root-owned deployment configuration supplies only paths; never credential values.
const required = (name: string) => {
  const value = process.env[name];
  if (!value?.startsWith("/")) throw new Error(`${name} must be an absolute path`);
  return value;
};
await startBroker({
  socket: required("GITZETTE_BROKER_SOCKET"), state: required("GITZETTE_BROKER_STATE"),
  config: required("GITZETTE_BROKER_CONFIG"), work: required("GITZETTE_BROKER_WORK"),
  node: "/usr/bin/node", cli: "/opt/openclaw-global/node_modules/openclaw/dist/index.js",
  beforeRequest: () => checkOAuthOwner(required("GITZETTE_BROKER_STATE"), OAUTH_PROFILE_ID),
});
console.log("GitZette local OAuth inference service ready");
