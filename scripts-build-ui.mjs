import { readFile, writeFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
const css = await readFile("public/agent.css", "utf8"),
  host = await readFile("public/agent-host.js", "utf8"),
  view = (await readFile("public/agent-view.js", "utf8")).replaceAll(
    "export ",
    "",
  );
for (const name of ["agent", "confirm"]) {
  const path = `public/${name}.html`;
  let html = await readFile(path, "utf8");
  html = html
    .replace(/\/\*INLINE_CSS\*\/[\s\S]*?(?=<\/style>)/, `/*INLINE_CSS*/${css}`)
    .replace(
      /\/\*INLINE_VIEW\*\/[\s\S]*?(?=\n(?:\/\*INLINE_HOST\*\/|const (?:root|config)=))/,
      `/*INLINE_VIEW*/${view}`,
    );
  if (name === "agent")
    html = html.replace(
      /\/\*INLINE_HOST\*\/[\s\S]*?(?=<\/script>)/,
      `/*INLINE_HOST*/${host}`,
    );
  await writeFile(path, html);
}
