# MediaMTX waits until timestamps move 2s before it will say the camera
# is publishing. These VIGI lines reset the clock before that, so the
# picture never starts. Start the relay as soon as the H264 config is in,
# and ignore G.711 so the video line stays up.
FROM golang:1.26 AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY gortmplib-vigi.patch /tmp/gortmplib-vigi.patch
RUN git clone --depth 1 --branch v1.0.2 https://github.com/bluenviron/gortmplib.git /src/gortmplib \
	&& git -C /src/gortmplib apply /tmp/gortmplib-vigi.patch \
	&& git clone --depth 1 --branch v1.21.0 https://github.com/bluenviron/mediamtx.git /src/mediamtx
WORKDIR /src/mediamtx
RUN printf 'v1.21.0' > internal/core/VERSION \
	&& printf '/* player page unused */' > internal/servers/hls/hls.min.js \
	&& go mod edit -replace github.com/bluenviron/gortmplib=/src/gortmplib \
	&& GOSUMDB=off go build -o /mediamtx .

FROM debian:bookworm-slim
COPY --from=build /mediamtx /mediamtx
ENTRYPOINT ["/mediamtx"]
