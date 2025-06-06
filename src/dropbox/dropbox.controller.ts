import { Controller, Post, Body, Res, HttpStatus, Get, Query } from '@nestjs/common';
import { DropboxService } from './dropbox.service';
import { Response } from 'express';

@Controller('api/dropbox')
export class DropboxController {
    constructor(private readonly dropboxService: DropboxService) { }

    @Post('download')
    async downloadFromDropbox(@Body() body: any, @Res() res: Response) {
        try {
            const result = await this.dropboxService.downloadFiles(body)
            return res.status(HttpStatus.OK).json(result);
        } catch (err) {
            const status = err.status || HttpStatus.INTERNAL_SERVER_ERROR;
            return res.status(status).json({ status: 'error', message: err.message });
        }
    }
    @Get('oauth/callback')
    async handleDropboxOAuthCallback(@Query('code') code: string, @Res() res: Response) {
        try {
            const tokenInfo = await this.dropboxService.exchangeCodeForToken(code); 
            return res.status(HttpStatus.OK).json({
                status: 'success',
                message: 'Dropbox authorized successfully'
            });
        } catch (err) {
            return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                status: 'error',
                message: err.message,
            });
        }
    }
}