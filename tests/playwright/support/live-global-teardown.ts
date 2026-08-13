import { runtime } from "./runtime";

export default async function globalTeardown() {
  if (!runtime.useLiveBackend) return;
}
