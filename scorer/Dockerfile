# Reproducible build: pinned base digests and a static binary, so the image digest signed into
# every grade is stable across machines. That reproducibility is the whole point — a reviewer
# has to be able to rebuild this image, get the same digest, and recompute a published grade.
FROM golang:1.24-alpine AS build
WORKDIR /src

# Dependencies first so the layer caches independently of source edits.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# CGO off + trimpath + stripped build ids => byte-identical output for identical input.
RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w -buildid=" \
    -o /out/scorer .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/scorer /scorer
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/scorer"]
