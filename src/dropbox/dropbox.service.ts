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
    }

    private async getAccessTokenForUser(userIdentity: string): Promise<string> {

        const { data, error } = await this.supabase
            .from('DropBoxUsers')
            .select('*').eq("email", userIdentity)

        if (error) {
            throw error;
        }
        if (!data || data.length === 0 || !data[0]?.refresh_token) {
            throw new HttpException(
                'Dropbox access not authorized for this user. Please ensure the user has pre-authorized your application.',
                HttpStatus.UNAUTHORIZED,
            );
        }

        const refreshToken = data[0]?.refresh_token;

        // console.log('Going for refresh…');
        this.dbxAuth.setRefreshToken(refreshToken);

        try {
            await this.dbxAuth.refreshAccessToken();
            // console.log("------------ raw response ---------", rawResponse)
            const newAccessToken = this.dbxAuth.getAccessToken();
            // console.log('New access token:', newAccessToken);
            return newAccessToken;
        } catch (e) {
            console.error('Error refreshing token:', e);
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

        const response = await this.dbxAuth.getAccessTokenFromCode(redirectUri, code) as any;

        const dbx2 = new Dropbox({ accessToken: response.result.access_token || "" });

        const userEmail = await dbx2.usersGetCurrentAccount() as any;

        // console.log(response.result);

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

        console.log('Upserted data:', data);

        return response.result;
    }

    async downloadFiles(payload: any): Promise<any> {
        const { dropboxLink, userIdentity, destinationFolder } = payload;

        if (!dropboxLink || !userIdentity) {
            throw new HttpException(
                "'dropboxLink' and 'userIdentity' are required",
                HttpStatus.BAD_REQUEST
            );
        }

        let token: string;
        try {
            token = await this.getAccessTokenForUser(userIdentity);
        } catch (err) {
            if (err instanceof HttpException) throw err;
            throw new HttpException('User not found', HttpStatus.NOT_FOUND);
        }

        const dbx = new Dropbox({ auth: this.dbxAuth });

        const localRoot = path.resolve(
            destinationFolder || 'uploads/dropbox_downloads/' + Date.now().toString()
        );
        fs.mkdirSync(localRoot, { recursive: true });

        try {
            const metadata: any = await dbx.sharingGetSharedLinkMetadata({ url: dropboxLink });
            // console.log(metadata)
            const downloadedFiles = [];

            if (metadata.result['.tag'] === 'file') {
                await this.downloadFile(dbx, dropboxLink, localRoot, metadata.result.name, downloadedFiles);
            } else if (metadata.result['.tag'] === 'folder') {
                await this.downloadFolder(dbx, dropboxLink, metadata.result.path_lower, localRoot, downloadedFiles);
            } else {
                throw metadata;
            }

            return {
                status: 'success',
                message: 'Files downloaded successfully.',
                downloadedFiles,
                destinationFolder: localRoot,
            };

        } catch (err: any) {
            console.log(err);
            if (err?.error?.error_summary?.includes('access_denied')) {
                throw new HttpException('Access denied to the Dropbox link', HttpStatus.FORBIDDEN);
            }


            if (err?.error?.error_summary?.includes('shared_link_not_found')) {
                throw new HttpException('Dropbox link not found', HttpStatus.NOT_FOUND);
            }

            if (dropboxLink === 'simulate-server-error') {
                throw new HttpException('An unexpected error occurred', HttpStatus.INTERNAL_SERVER_ERROR);
            }

            console.error('Unexpected error:', err);
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
        const { result } = await dbx.sharingGetSharedLinkFile({ url: sharedLink }) as any;
        const fullPath = path.join(localPath, fileName);
        fs.writeFileSync(fullPath, result.fileBinary as Buffer);

        downloadedFiles.push({
            fileName,
            filePath: fullPath,
            sizeBytes: (result.fileBinary as Buffer).length,
        });
    }

    private async downloadFolder(
        dbx: Dropbox,
        sharedLink: string,
        pathLower: string,
        localPath: string,
        downloadedFiles: any[],
    ) {
        const queue = [''];

        while (queue.length) {
            const currentPath = queue.pop();
            const res = await dbx.filesListFolder({
                path: currentPath as string,
                shared_link: { url: sharedLink },
                recursive: true,
            });

            for (const entry of res.result.entries) {
                if (entry['.tag'] === 'file') {
                    const { result: file } = await dbx.filesDownload({ path: entry.path_lower as string }) as any;
                    const fullPath = path.join(localPath, (entry.path_lower as string).replace(/^\//, ''));
                    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                    fs.writeFileSync(fullPath, file.fileBinary as Buffer);
                    downloadedFiles.push({
                        fileName: entry.name,
                        filePath: fullPath,
                        sizeBytes: (file.fileBinary as Buffer).length,
                    });
                } else if (entry['.tag'] === 'folder') {
                    queue.push(entry.path_lower as string);
                }
            }
        }
    }
}