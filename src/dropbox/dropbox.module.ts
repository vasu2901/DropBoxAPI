import { Module } from '@nestjs/common';
import { DropboxService } from './dropbox.service';
import { DropboxController } from './dropbox.controller';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [HttpModule],
  controllers: [DropboxController],
  providers: [DropboxService],
})
export class DropboxModule {}