import { startBroker } from "./oauth-broker";
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
});
console.log("GitZette local OAuth inference service ready");
