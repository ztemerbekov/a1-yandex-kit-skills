import { accessSync, readFileSync } from "node:fs";

// The local token page only helps when a browser on the user's computer can
// open this host's 127.0.0.1. These markers identify sessions where it
// cannot: a remote shell, a container, or a headless Linux host. Everything
// is injectable so the matrix is testable on any platform without touching
// the real filesystem or environment.
const SSH_VARIABLES = ["SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"];
const CONTAINER_MARKER_FILES = ["/.dockerenv", "/run/.containerenv"];
const CGROUP_MARKERS = ["docker", "containerd", "kubepods", "lxc", "libpod"];

function defaultExists(filePath) {
  try {
    accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function defaultReadText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

// Returns a human-readable reason why the local token page is unreachable
// from this session, or null when a local browser can plausibly open it.
export function unreachableReason({
  env = process.env,
  platform = process.platform,
  fsProbe = {},
} = {}) {
  const exists = fsProbe.exists ?? defaultExists;
  const readText = fsProbe.readText ?? defaultReadText;

  const sshVariable = SSH_VARIABLES.find((name) => env[name]);
  if (sshVariable) {
    return `The session runs over SSH (${sshVariable} is set); a browser on the user's computer cannot reach this host's 127.0.0.1.`;
  }
  const markerFile = CONTAINER_MARKER_FILES.find((file) => exists(file));
  if (markerFile) {
    return `The session runs inside a container (${markerFile} exists); the user's browser cannot reach its 127.0.0.1.`;
  }
  // Cgroup v1 containers name their runtime in PID 1's cgroup. Cgroup v2
  // often shows a bare "0::/", which is why the marker files come first.
  const cgroup = readText("/proc/1/cgroup");
  if (cgroup) {
    const marker = CGROUP_MARKERS.find((name) => cgroup.includes(name));
    if (marker) {
      return `The session runs inside a container (PID 1 cgroup mentions "${marker}"); the user's browser cannot reach its 127.0.0.1.`;
    }
  }
  if (platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY) {
    return "The session runs on Linux without DISPLAY or WAYLAND_DISPLAY; there is no local browser to open the page.";
  }
  return null;
}
