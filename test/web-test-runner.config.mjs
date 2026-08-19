import { defaultReporter, summaryReporter } from '@web/test-runner'

export default {
  testRunnerHtml: testFramework => `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="htmx-config" content='{
          "extensions": "hx-signalr",
          "history": false,
          "includeIndicatorCSS": false,
          "defaultSettleDelay": 0
        }'>
        <title>hx-signalr tests</title>
      </head>
      <body>
        <script src="node_modules/chai/chai.js"></script>
        <script src="node_modules/htmx.org/dist/htmx.js"></script>
        <script>
          window.assert = window.chai.assert
        </script>
        <script src="dist/hx-signalr.js"></script>
        <script src="test/lib/helpers.js"></script>
        <script type="module" src="${testFramework}"></script>
        <div id="test-playground"></div>
      </body>
    </html>
  `,
  nodeResolve: true,
  files: ['test/tests/**/*.js'],
  reporters: [
    summaryReporter({ flatten: false, reportTestLogs: false, reportTestErrors: true }),
    defaultReporter({ reportTestProgress: true, reportTestResults: true })
  ]
}
