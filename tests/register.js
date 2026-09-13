/**
 * Registered with `node --import` so the JSX transform is in place before any
 * test file is parsed — a loader that a test file imports itself is too late
 * for that file's own JSX.
 */
import { registerJsx } from "./jsx-loader.js"
registerJsx()
