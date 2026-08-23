const fs = require("fs");
const path = require("path");

const repoRoot = __dirname;
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf8");
const appJs = fs.readFileSync(path.join(repoRoot, "app.js"), "utf8");
const boardJs = fs.readFileSync(path.join(repoRoot, "board.js"), "utf8");

function getIdsFromHtml(html) {
  return new Set([...html.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
}

function getDomIdRefs(source) {
  return new Set([
    ...[...source.matchAll(/\bel\("([^"]+)"\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/getElementById\("([^"]+)"\)/g)].map((match) => match[1]),
    ...[...source.matchAll(/querySelector\("#([^"]+)"\)/g)].map((match) => match[1]),
  ]);
}

describe("DOM reference regression checks", () => {
  test("app.js does not reference removed PR #13 elements", () => {
    expect(appJs).not.toMatch(/gameMeta/);
    expect(appJs).not.toMatch(/boardTitle/);
  });

  test("app.js and board.js only reference IDs that still exist in index.html", () => {
    const htmlIds = getIdsFromHtml(indexHtml);
    const referencedIds = new Set([...getDomIdRefs(appJs), ...getDomIdRefs(boardJs)]);
    expect([...referencedIds].filter((id) => !htmlIds.has(id))).toEqual([]);
  });
});
