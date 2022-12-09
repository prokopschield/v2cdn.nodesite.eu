import { encode } from "doge-json";
import http from "http";
import https from "https";
import { saturate, store } from "nsblob-stream";
import { Database, descriptors } from "nscdn-csvdb";

export async function main(port: number) {
    const database = new Database(".");

    const files = await database.getTable("files", {
        id: descriptors.JsNumberType,
        name: descriptors.JsStringType,
        hash: descriptors.JsStringType,
        type: descriptors.JsStringType,
        size: descriptors.JsNumberType,
        time: descriptors.JsNumberType,
    });

    let [{ id }] = await files.find({}, "| wc -l");

    id ||= 0;

    const server = http.createServer(async (request, response) => {
        try {
            let length = 0;
            request.on("data", (chunk: Buffer) => (length += chunk.length));

            const request_hash = await store(request);

            const url: URL = new URL(
                request.url || "",
                "https://cdn.nodesite.eu"
            );

            let name = url.pathname.slice(1);

            if (
                request_hash ===
                    "e436acb4b40175eb9014c83cdc3e937a042345845191cd6e7e901be3affd0943" ||
                request_hash ==
                    "69217a3079908094e11121d042354a7c1f55b6482ca1a51e1b250dfd1ed0eef9"
            ) {
                // request has no body

                if (request.method?.toLowerCase() !== "get") {
                    response.statusCode = 200;

                    response.setHeader("Access-Control-Allow-Origin", "*");
                    response.setHeader("Access-Control-Allow-Methods", "*");
                    response.setHeader("Access-Control-Allow-Headers", "*");

                    response.end();

                    return;
                }

                const [file] = await files.find_first({ name });

                if (!file) {
                    return new Promise<void>((resolve) => {
                        const v1_request = https.request(
                            `https://cdn.nodesite.eu/${name}`,
                            (v1_response) => {
                                response.statusCode =
                                    v1_response.statusCode || 500;

                                for (const [key, value] of Object.entries(
                                    v1_response.headers
                                )) {
                                    if (key && value) {
                                        response.setHeader(key, value);
                                    }
                                }

                                v1_response.on("data", (chunk) =>
                                    response.write(chunk)
                                );
                                v1_response.on("end", () => response.end());

                                return resolve();
                            }
                        );

                        for (const [key, value] of Object.entries(
                            request.headers
                        )) {
                            if (key && value && key !== "host") {
                                v1_request.setHeader(key, value);
                            }
                        }

                        v1_request.end();
                    });
                }

                if (url.searchParams.has("info")) {
                    response.statusCode = 200;

                    response.setHeader("Content-Type", "application/json");
                    response.setHeader("Access-Control-Allow-Origin", "*");
                    response.setHeader("Access-Control-Allow-Methods", "*");
                    response.setHeader("Access-Control-Allow-Headers", "*");

                    response.write(encode(file));
                    response.end();

                    return;
                }

                if (request.headers.range) {
                    const matches = request.headers.range.match(/[\d]+/g) || [];

                    let [first, last] = [
                        ...matches,
                        matches.length ? file.size - 1 : 0,
                        file.size - 1,
                    ].map(Number);

                    if (last >= file.size) {
                        last = file.size - 1;
                    }

                    if (first >= last) {
                        first = last;
                    }

                    response.statusCode = 206;

                    response.setHeader("Content-Type", file.type);
                    response.setHeader(
                        "Content-Range",
                        `bytes ${first}-${last}/${file.size}`
                    );
                    response.setHeader("Content-Length", file.size);

                    return saturate(
                        file.hash,
                        response,
                        Number(first),
                        Number(last) + 1
                    );
                } else {
                    response.statusCode = 200;

                    response.setHeader("Content-Type", file.type);
                    response.setHeader("Content-Length", file.size);

                    return saturate(file.hash, response);
                }
            } else {
                if (
                    name.match(/[a-f0-9]{64}$/gi) ||
                    (await files.find_first({ name })).length
                ) {
                    name = "file" + String(id + 1);
                }

                const object = {
                    id: ++id,
                    hash: request_hash,
                    name,
                    size: length,
                    time: Date.now(),
                    type: request.headers["content-type"] || "text/plain",
                };

                await files.insert(object);

                response.setHeader("Content-Type", "application/json");
                response.write(encode(object));
                response.end();
            }
        } catch (error) {
            response.statusCode = 500;
            response.setHeader("Content-Type", "text/plain");
            response.write(String(error));
            response.end();
        }
    });

    server.listen(port);
}
