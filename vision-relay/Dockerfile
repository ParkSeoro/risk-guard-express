# MediaMTX waits until timestamps move 2s before it will say the camera
# is publishing. These VIGI lines reset the clock before that, so the
# picture never starts. Start the relay as soon as the H264 config is in.
FROM golang:1.26 AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --depth 1 --branch v1.0.2 https://github.com/bluenviron/gortmplib.git /src/gortmplib \
	&& sed -i 's/if (curTime - startTime) >= analyzePeriod {/if videoTracks[0] != nil || (curTime - startTime) >= analyzePeriod {/' /src/gortmplib/reader.go \
	&& git clone --depth 1 --branch v1.21.0 https://github.com/bluenviron/mediamtx.git /src/mediamtx
WORKDIR /src/mediamtx
RUN printf 'v1.21.0' > internal/core/VERSION \
	&& printf '/* player page unused */' > internal/servers/hls/hls.min.js \
	&& go mod edit -replace github.com/bluenviron/gortmplib=/src/gortmplib \
	&& GOSUMDB=off go build -o /mediamtx .

FROM debian:bookworm-slim
COPY --from=build /mediamtx /mediamtx
ENTRYPOINT ["/mediamtx"]
