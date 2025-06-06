

# Dropbox File Download API - NestJS

## 📌 Overview
This API endpoint allows authenticated Dropbox users to download files (or folders) from a public Dropbox link and store them on a local drive.

Setup

```bash
1. Clone the repository
2. Install packages using npm
3. Create the env file

```
## Usage

```bash
Authorize the APP using - 'https://www.dropbox.com/oauth2/authorize?client_id=fgu9ffprmujvz58&response_type=code&token_access_type=offline&redirect_uri=https://dropboxapi-pearlthoughts.onrender.com/api/dropbox/oauth/callback'
```

## 📎 Endpoint Details

**POST** `/api/dropbox/download`

### Request Body
```json
{
  "dropboxLink": "https://www.dropbox.com/s/example-link?dl=0",
  "userIdentity": "user@example.com",
  "destinationFolder": "downloads/folder-name"
}
```
#### Request Payload
| **Field**           | **Type** | **Required** | **Description**                                           |
| ------------------- | -------- | ------------ | --------------------------------------------------------- |
| `dropboxLink`       | string   | ✅ Yes        | Shared Dropbox file or folder link                        |
| `userIdentity`      | string   | ✅ Yes        | Email/username used to fetch pre-authorized refresh token |
| `destinationFolder` | string   | ❌ No         | Optional relative path on local drive for storing files   |

✅ Success Response (200 OK)
```json
{
  "status": "success",
  "message": "Files downloaded successfully.",
  "downloadedFiles": [
    {
      "fileName": "image.jpg",
      "filePath": "/path/to/folder/image.jpg",
      "sizeBytes": 10240
    }
  ],
  "destinationFolder": "/path/to/folder"
}
```
#### ❌ Error Responses
| **Status** | **Message**                                                              |
| ---------- | ------------------------------------------------------------------------ |
| 400        | `"Invalid request payload. 'dropboxLink' is required."`                  |
| 401        | `"Dropbox access not authorized for this user."`                         |
| 403        | `"Access denied to the Dropbox link. Insufficient permissions."`         |
| 404        | `"Dropbox link not found or invalid."`                                   |
| 500        | `"An unexpected error occurred during file download. Please try again."` |

#### 🔐 Security
Refresh tokens are securely stored.

Input validation & path sanitization applied.

HTTPS is mandatory for all API communications.

The Dropbox client secret is never exposed.

#### 🧪 Testing
Run tests using:

```bash
npm run test:e2e
```
Test coverage includes:

Valid downloads

Invalid/missing parameters

Unauthorized tokens

Permission errors

Dropbox link issues

Server failure

#### ⚙️ Future Enhancements
Background job queue for large files.

Progress tracking.

File overwrite strategies.

Webhook notifications for Dropbox changes.

#### 📁 Tech Stack
Framework: NestJS

Language: TypeScript

Dropbox SDK: Official Dropbox Node.js SDK (dropbox package)

Filesystem: Node.js fs module

Testing: Jest + Supertest
