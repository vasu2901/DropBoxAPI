// download-from-dropbox.e2e-spec.ts (using Jest and Supertest)
import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

describe('Dropbox Download API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should return 200 and list of downloaded files (valid request)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dropbox/download')
      .send({
        "dropboxLink": "https://www.dropbox.com/scl/fi/gqtzj8ztn5s3pr2suiw4s/temp.txt?rlkey=koblc1ak1d8gy0qlczw7ocypn&st=1z3w2rc1&dl=0",
        "userIdentity": "jaysonpayne68@gmail.com",
        "destinationFolder": "downloads/test_user"
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(Array.isArray(res.body.downloadedFiles)).toBe(true);
  }, 15000);

  it('should return 400 for missing dropboxLink', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dropbox/download')
      .send({ userIdentity: 'jasonpayne68@gmail.com' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain("'dropboxLink' and 'userIdentity' are required");
  });

  it('should return 401 for unauthorized Dropbox access', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dropbox/download')
      .send({
        dropboxLink: 'https://www.dropbox.com/scl/fi/gqtzj8ztn5s3pr2suiw4s/temp.txt?rlkey=koblc1ak1d8gy0qlczw7ocypn&st=1z3w2rc1&dl=0',
        userIdentity: 'unauthorizeduser@example.com'
      });

    expect(res.status).toBe(401);
    expect(res.body.message).toContain('Dropbox access not authorized');
  });

  it('should return 404 for non-existent dropbox link', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/dropbox/download')
      .send({
        dropboxLink: 'https://www.dropbox.com/home/test-fo34der',
        userIdentity: 'jaysonpayne68@gmail.com'
      });
    expect(res.status).toBe(404);
  });

});
