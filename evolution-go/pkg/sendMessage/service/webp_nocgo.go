//go:build !cgo
// +build !cgo

package send_service

import (
	"bytes"
	"fmt"
	"image"
	"image/png"
	"io"
	"os/exec"

	x_webp "golang.org/x/image/webp"
)

func encodeWebP(img image.Image, quality float32) ([]byte, error) {
	if ffmpegPath, err := exec.LookPath("ffmpeg"); err == nil {
		var pngBuf bytes.Buffer
		if err := png.Encode(&pngBuf, img); err == nil {
			cmd := exec.Command(ffmpegPath, "-i", "pipe:0", "-vcodec", "libwebp", "-quality", fmt.Sprintf("%.0f", quality), "-f", "webp", "pipe:1")
			cmd.Stdin = &pngBuf
			var outBuf bytes.Buffer
			cmd.Stdout = &outBuf
			if err := cmd.Run(); err == nil && outBuf.Len() > 0 {
				return outBuf.Bytes(), nil
			}
		}
	}
	return nil, fmt.Errorf("webp encoding requires CGO or ffmpeg in PATH")
}

func decodeWebP(r io.Reader) (image.Image, error) {
	return x_webp.Decode(r)
}
