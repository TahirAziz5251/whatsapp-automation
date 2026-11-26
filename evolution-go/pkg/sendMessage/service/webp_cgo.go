//go:build cgo
// +build cgo

package send_service

import (
	"bytes"
	"image"
	"io"

	chai_webp "github.com/chai2010/webp"
)

func encodeWebP(img image.Image, quality float32) ([]byte, error) {
	var webpBuffer bytes.Buffer
	err := chai_webp.Encode(&webpBuffer, img, &chai_webp.Options{Lossless: false, Quality: quality})
	if err != nil {
		return nil, err
	}
	return webpBuffer.Bytes(), nil
}

func decodeWebP(r io.Reader) (image.Image, error) {
	return chai_webp.Decode(r)
}
