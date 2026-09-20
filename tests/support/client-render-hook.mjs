import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import ts from 'typescript'

/**
 * Makes the browser half testable under `node:test`:
 *
 *  - `.tsx` is transpiled with the project's own TypeScript (Node's type
 *    stripping handles `.ts` but not JSX);
 *  - `@deepseek-ai/dsh-client-ui-primitives` is redirected to a local stub, since
 *    the published package cannot be imported outside a browser bundle (CSS
 *    modules and undeclared transitive dependencies).
 *
 * Load it with `node --import ./tests/support/client-render-hook.mjs`.
 */
const STUB = new URL('./primitives-stub.mjs', import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
      return { url: STUB, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },

  load(url, context, nextLoad) {
    if (url.endsWith('.tsx')) {
      const { outputText } = ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        fileName: url,
        compilerOptions: {
          jsx: ts.JsxEmit.ReactJSX,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2023,
          sourceMap: false,
        },
      })
      return { format: 'module', source: outputText, shortCircuit: true }
    }
    return nextLoad(url, context)
  },
})
