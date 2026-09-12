import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const directory = dirname(fileURLToPath(import.meta.url));
const destination = resolve(directory, "dist/index.html");
const result = await build({
  entryPoints: [resolve(directory, "main.tsx")],
  bundle: true,
  write: false,
  outdir: "out",
  minify: true,
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "inline",
});
const script = result.outputFiles
  .find((file) => file.path.endsWith(".js"))
  .text.replaceAll("</script", "<\\/script");
const styles = result.outputFiles.find((file) =>
  file.path.endsWith(".css"),
).text;
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="color-scheme" content="dark"><title>Authon — 하단 중심 작업 화면 목업</title><style>${styles}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html);
console.log(
  `목업 생성: ${destination} (${Math.round(Buffer.byteLength(html) / 1024)} KB)`,
);

if (process.argv.includes("--serve")) {
  const server = createServer(async (request, response) => {
    if (request.url !== "/" && request.url !== "/index.html") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(await readFile(destination));
  });
  server.listen(4176, "127.0.0.1", () =>
    console.log("목업 미리보기: http://127.0.0.1:4176"),
  );
}
