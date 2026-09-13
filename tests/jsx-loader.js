/**
 * Let `node --test` import the app's `.jsx` files.
 *
 * Node will not load JSX, and the components were therefore untestable — which
 * is why every UI bug this project has had was found by hand in a browser
 * instead of by the suite. esbuild is already here (Vite depends on it, Astro
 * depends on Vite), so this is a transform and a loader hook rather than a new
 * dependency or a test framework.
 *
 * Registered from `tests/dom.js`, so a test file only has to import that.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { registerHooks } from "node:module"
import { transformSync } from "esbuild"

let registered = false

export function registerJsx() {
  if (registered) return
  registered = true

  registerHooks({
    /**
     * Extensionless relative imports.
     *
     * The app is written for Vite, which resolves `../../lib/useRoom` to a
     * file; Node does not, and refuses at the first component that does it.
     * Try the extensions Vite would, in the order it would, and otherwise get
     * out of the way — a specifier that resolves normally must not be touched,
     * or this starts shadowing real module resolution.
     */
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context)
      } catch (err) {
        if (!specifier.startsWith(".") && !specifier.startsWith("/")) throw err
        for (const ext of [".js", ".jsx", "/index.js", "/index.jsx"]) {
          try {
            return nextResolve(specifier + ext, context)
          } catch {
            /* try the next one */
          }
        }
        throw err
      }
    },

    load(url, context, nextLoad) {
      if (!url.endsWith(".jsx")) return nextLoad(url, context)
      const source = readFileSync(fileURLToPath(url), "utf8")
      const { code } = transformSync(source, {
        loader: "jsx",
        format: "esm",
        // The automatic runtime, so files do not need React in scope — which
        // matches how Astro builds them and means a component that compiles
        // for the app compiles here.
        jsx: "automatic",
        sourcefile: url,
      })
      return { format: "module", source: code, shortCircuit: true }
    },
  })
}
