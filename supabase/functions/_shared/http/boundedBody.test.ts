import { describe, expect, it } from "vitest";
import { boundRequestBody } from "./boundedBody.ts";

function streamed(bytes: number): Request {
  // Un corps en flux, SANS Content-Length : le cas que l'en-tête ne protège pas.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let sent = 0; sent < bytes; sent += 1000) controller.enqueue(new Uint8Array(Math.min(1000, bytes - sent)));
      controller.close();
    },
  });
  return new Request("https://portal.test/v1/demandes", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("boundRequestBody", () => {
  it("laisse passer un corps sous la borne, intact", async () => {
    const request = boundRequestBody(
      new Request("https://portal.test/v1/demandes", { method: "POST", body: JSON.stringify({ a: 1 }), headers: { "content-type": "application/json" } }),
      1024,
    );
    expect(await request.json()).toEqual({ a: 1 });
    expect(request.headers.get("content-type")).toBe("application/json");
  });

  it("fait échouer la lecture d'un corps en flux au-delà de la borne", async () => {
    await expect(boundRequestBody(streamed(5000), 4096).arrayBuffer()).rejects.toThrow();
  });

  it("ne touche pas une requête sans corps", () => {
    const request = new Request("https://portal.test/v1/session");
    expect(boundRequestBody(request, 10)).toBe(request);
  });
});
