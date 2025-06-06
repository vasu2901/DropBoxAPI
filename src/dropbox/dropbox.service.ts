import { Injectable, Inject, HttpException, HttpStatus } from '@nestjs/common';
import { Dropbox, DropboxAuth } from 'dropbox';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../supabase/supabase.module';
dotenv.config();

@Injectable()
export class DropboxService {
    private dbxAuth: DropboxAuth;

    constructor(
        @Inject(SUPABASE_CLIENT)
        private readonly supabase: SupabaseClient
    ) {
        this.dbxAuth = new DropboxAuth({
            clientId: process.env.DROPBOX_APP_KEY,
            clientSecret: process.env.DROPBOX_APP_SECRET
        });
        console.log('DropboxService initialized');
    }

    private async getAccessTokenForUser(userIdentity: string): Promise<string> {
        console.log(`Fetching access token for user: ${userIdentity}`);

        const { data, error } = await this.supabase
            .from('DropBoxUsers')
            .select('*').eq("email", userIdentity);

        if (error) {
            console.error('Supabase error fetching user:', error);
            throw error;
        }
        if (!data || data.length === 0 || !data[0]?.refresh_token) {
            console.warn(`No refresh token found for user: ${userIdentity}`);
            throw new HttpException(
                'Dropbox access not authorized for this user. Please ensure the user has pre-authorized your application.',
                HttpStatus.UNAUTHORIZED,
            );
        }

        const refreshToken = data[0]?.refresh_token;
        this.dbxAuth.setRefreshToken(refreshToken);
        console.log(`Refresh token found for user: ${userIdentity}, attempting token refresh.`);

        try {
            await this.dbxAuth.refreshAccessToken();
            const newAccessToken = this.dbxAuth.getAccessToken();
            console.log(`Access token refreshed successfully for user: ${userIdentity}`);
            return newAccessToken;
        } catch (e) {
            console.error(`Error refreshing access token for user: ${userIdentity}`, e);
            if (e?.error?.error?.includes('invalid_grant')) {
                throw new HttpException('Dropbox access not authorized for this user. Please ensure the user has pre-authorized your application.', HttpStatus.UNAUTHORIZED);
            }
            else {
                throw new HttpException('Failed to refresh access token', HttpStatus.INTERNAL_SERVER_ERROR);
            }
        }
    }

    async exchangeCodeForToken(code: string) {
        const redirectUri = process.env.DROPBOX_REDIRECT_URL as string;
        console.log('Exchanging code for token');

        try {
            const response = await this.dbxAuth.getAccessTokenFromCode(redirectUri, code) as any;
            const dbx2 = new Dropbox({ accessToken: response.result.access_token || "" });
            const userEmail = await dbx2.usersGetCurrentAccount() as any;

            console.log(`User authenticated: ${userEmail.result.email}`);

            const { data, error } = await this.supabase
                .from('DropBoxUsers')
                .upsert(
                    {
                        email: userEmail.result.email,
                        ...response.result
                    },
                    {
                        onConflict: 'email' // for checking whether user exists or not.
                    }
                );

            if (error) {
                console.error('Upsert error:', error);
                return error;
            }

            console.log('Upserted user token data:', data);
            return response.result;
        } catch (e) {
            console.error('Error during token exchange:', e);
            throw e;
        }
    }

    async downloadFiles(payload: any): Promise<any> {
        const { dropboxLink, userIdentity, destinationFolder } = payload;

        if (!dropboxLink || !userIdentity) {
            console.warn("'dropboxLink' and 'userIdentity' are required");
            throw new HttpException(
                "'dropboxLink' and 'userIdentity' are required",
                HttpStatus.BAD_REQUEST
            );
        }
        console.log(`Starting download for user: ${userIdentity}, link: ${dropboxLink}`);

        let token: string;
        try {
            token = await this.getAccessTokenForUser(userIdentity);
        } catch (err) {
            if (err instanceof HttpException) {
                console.error('Token fetch error:', err.message);
                throw err;
            }
            console.error('User not found error:', err);
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        const dbx = new Dropbox({ auth: this.dbxAuth });
        const localRoot = path.resolve(
            destinationFolder || 'uploads/dropbox_downloads/' + Date.now().toString()
        );
        fs.mkdirSync(localRoot, { recursive: true });

        try {
            let metadata: any;
            // Detect if the link is a shared/public URL (starts with https://www.dropbox.com)
            if (dropboxLink.startsWith('https://www.dropbox.com')) {
                console.log('Detected shared/public Dropbox link.');
                metadata = await dbx.sharingGetSharedLinkMetadata({ url: dropboxLink }) as any;
            } else {
                console.log('Detected private Dropbox path.');
                metadata = await dbx.filesGetMetadata({ path: dropboxLink }) as any;
            }

            const downloadedFiles: any[] = [];

            if (metadata.result['.tag'] === 'file') {
                console.log(`Downloading single file: ${metadata.result.name}`);
                if (dropboxLink.startsWith('https://www.dropbox.com')) {
                    await this.downloadFile(dbx, dropboxLink, localRoot, metadata.result.name, downloadedFiles);
                } else {
                    await this.downloadFileByPath(dbx, dropboxLink, localRoot, metadata.result.name, downloadedFiles);
                }
            } else if (metadata.result['.tag'] === 'folder') {
                console.log(`Downloading folder: ${metadata.result.name}`);
                if (dropboxLink.startsWith('https://www.dropbox.com')) {
                    await this.downloadFolderSharedLink(dbx, dropboxLink, localRoot, downloadedFiles);
                } else {
                    await this.downloadFolderPrivatePath(dbx, dropboxLink, localRoot, downloadedFiles);
                }
            } else {
                console.error('Unknown metadata type:', metadata);
                throw new Error('Unknown Dropbox metadata type');
            }

            console.log(`Download complete: ${downloadedFiles.length} files saved to ${localRoot}`);
            return {
                status: 'success',
                message: 'Files downloaded successfully.',
                downloadedFiles,
                destinationFolder: localRoot,
            };

        } catch (err: any) {
            console.error('Download error:', err);

            if (err?.error?.error_summary?.includes('access_denied')) {
                throw new HttpException('Access denied to the Dropbox link', HttpStatus.FORBIDDEN);
            }

            if (err?.error?.error_summary?.includes('shared_link_not_found')) {
                throw new HttpException('Dropbox link not found', HttpStatus.NOT_FOUND);
            }

            if (dropboxLink === 'simulate-server-error') {
                throw new HttpException('An unexpected error occurred', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            throw new HttpException('An unexpected error occurred', HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }

    private async downloadFile(
        dbx: Dropbox,
        sharedLink: string,
        localPath: string,
        fileName: string,
        downloadedFiles: any[],
    ) {
        console.log(`Downloading file from shared link: ${fileName}`);
        const { result } = await dbx.sharingGetSharedLinkFile({ url: sharedLink }) as any;
        const fullPath = path.join(localPath, fileName);
        fs.writeFileSync(fullPath, result.fileBinary as Buffer);

        downloadedFiles.push({
            fileName,
            filePath: fullPath,
            sizeBytes: (result.fileBinary as Buffer).length,
        });
        console.log(`File saved: ${fullPath}`);
    }

    private async downloadFileByPath(
        dbx: Dropbox,
        filePath: string,
        localPath: string,
        fileName: string,
        downloadedFiles: any[],
    ) {
        console.log(`Downloading file from private path: ${fileName}`);
        const { result } = await dbx.filesDownload({ path: filePath }) as any;
        const fullPath = path.join(localPath, fileName);
        fs.writeFileSync(fullPath, result.fileBinary as Buffer);

        downloadedFiles.push({
            fileName,
            filePath: fullPath,
            sizeBytes: (result.fileBinary as Buffer).length,
        });
        console.log(`File saved: ${fullPath}`);
    }

    private async downloadFolderSharedLink(
        dbx: Dropbox,
        sharedLink: string,
        localPath: string,
        downloadedFiles: any[],
    ) {
        console.log(`Downloading folder from shared link: ${sharedLink}`);
        let hasMore = true;
        let cursor: string | undefined = undefined;

        const listFolderArgs: any = {
            path: '',
            shared_link: { url: sharedLink },
            limit: 2000,
        };

        while (hasMore) {
            let res: any;
            if (!cursor) {
                res = await dbx.filesListFolder(listFolderArgs);
            } else {
                res = await dbx.filesListFolderContinue({ cursor });
            }
            console.log(`Fetched ${res.result.entries.length} entries from folder listing`);

            for (const entry of res.result.entries) {
                if (entry['.tag'] === 'file') {
                    // Use fallback to avoid undefined
                    const relativePath = entry.path_display ?? entry.path_lower ?? entry.name ?? 'unknown';
                    const safeRelativePath = relativePath.replace(/^\//, '');
                    const fullPath = path.join(localPath, safeRelativePath);
                    const folderPath = path.dirname(fullPath);
                    fs.mkdirSync(folderPath, { recursive: true });

                    console.log(`Downloading file: ${entry.name} from shared link`);
                    const { result: file } = await dbx.filesDownload({ path: entry.path_lower }) as any;
                    fs.writeFileSync(fullPath, file.fileBinary as Buffer);

                    downloadedFiles.push({
                        fileName: entry.name,
                        filePath: fullPath,
                        sizeBytes: (file.fileBinary as Buffer).length,
                    });
                    console.log(`File saved: ${fullPath}`);
                }
            }

            hasMore = res.result.has_more;
            cursor = res.result.cursor;
        }
    }


    private async downloadFolderPrivatePath(
        dbx: Dropbox,
        folderPath: string,
        localPath: string,
        downloadedFiles: any[],
    ) {
        console.log(`Downloading folder from private path: ${folderPath}`);
        let hasMore = true;
        let cursor: string | undefined = undefined;

        const listFolderArgs: any = {
            path: folderPath,
            recursive: true,
            limit: 2000,
        };

        while (hasMore) {
            let res: any;
            if (!cursor) {
                res = await dbx.filesListFolder(listFolderArgs);
            } else {
                res = await dbx.filesListFolderContinue({ cursor });
            }
            console.log(`Fetched ${res.result.entries.length} entries from folder listing`);

            for (const entry of res.result.entries) {
                if (entry['.tag'] === 'file') {
                    const fullPath = path.join(localPath, entry.path_display.replace(/^\//, ''));
                    const folderPath = path.dirname(fullPath);
                    fs.mkdirSync(folderPath, { recursive: true });

                    console.log(`Downloading file: ${entry.name} from private path`);
                    const { result: file } = await dbx.filesDownload({ path: entry.path_lower }) as any;
                    fs.writeFileSync(fullPath, file.fileBinary as Buffer);

                    downloadedFiles.push({
                        fileName: entry.name,
                        filePath: fullPath,
                        sizeBytes: (file.fileBinary as Buffer).length,
                    });
                    console.log(`File saved: ${fullPath}`);
                }
            }

            hasMore = res.result.has_more;
            cursor = res.result.cursor;
        }
    }
}
