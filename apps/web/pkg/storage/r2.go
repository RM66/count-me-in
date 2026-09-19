// Package storage orchestrates Cloudflare R2 media (avatars, service
// covers) — signed direct-browser upload URLs via the AWS SDK v2
// presigner (R2 is S3-compatible, ADR-007).
package storage

import (
	"context"
	"errors"
	"os"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

type r2Config struct {
	accountID     string
	accessKeyID   string
	secretAccess  string
	bucket        string
	publicBaseURL string
}

var (
	cfgOnce sync.Once
	cfg     r2Config
	cfgErr  error
)

// config validates lazily (throw on first use), like @repo/media-storage.
// The variable list is an ordered slice so the reported error is
// deterministic (map iteration would pick a random missing name).
func config() (r2Config, error) {
	cfgOnce.Do(func() {
		cfg = r2Config{
			accountID:     os.Getenv("R2_ACCOUNT_ID"),
			accessKeyID:   os.Getenv("R2_ACCESS_KEY_ID"),
			secretAccess:  os.Getenv("R2_SECRET_ACCESS_KEY"),
			bucket:        os.Getenv("R2_BUCKET"),
			publicBaseURL: os.Getenv("R2_PUBLIC_BASE_URL"),
		}
		for _, name := range []string{
			"R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
			"R2_BUCKET", "R2_PUBLIC_BASE_URL",
		} {
			if os.Getenv(name) == "" {
				cfgErr = errors.New(name + " is not set")
				return
			}
		}
	})
	return cfg, cfgErr
}

var (
	presignOnce   sync.Once
	presignClient *s3.PresignClient
)

func presigner() (*s3.PresignClient, error) {
	c, err := config()
	if err != nil {
		return nil, err
	}
	presignOnce.Do(func() {
		client := s3.New(s3.Options{
			Region:       "auto",
			BaseEndpoint: aws.String("https://" + c.accountID + ".r2.cloudflarestorage.com"),
			Credentials:  credentials.NewStaticCredentialsProvider(c.accessKeyID, c.secretAccess, ""),
			UsePathStyle: true,
		})
		presignClient = s3.NewPresignClient(client)
	})
	return presignClient, nil
}

// SignedUploadURL creates a signed PUT URL for direct browser upload
// to R2. The signature pins Content-Type and Content-Length, so the
// browser PUT must match them exactly (R2 rejects mismatches).
func SignedUploadURL(ctx context.Context, key, contentType string, contentLength int64) (uploadURL string, expiresAt time.Time, err error) {
	p, err := presigner()
	if err != nil {
		return "", time.Time{}, err
	}
	c, _ := config()
	const expiresIn = 10 * time.Minute
	req, err := p.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket:        aws.String(c.bucket),
		Key:           aws.String(key),
		ContentType:   aws.String(contentType),
		ContentLength: aws.Int64(contentLength),
	}, s3.WithPresignExpires(expiresIn))
	if err != nil {
		return "", time.Time{}, err
	}
	return req.URL, time.Now().Add(expiresIn), nil
}
