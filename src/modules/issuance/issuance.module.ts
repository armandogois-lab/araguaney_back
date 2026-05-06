import { Module } from '@nestjs/common';
import { InvestorsController } from './investors/investors.controller';
import { InvestorsService } from './investors/investors.service';
import { CertificatesController } from './certificates/certificates.controller';
import { CertificatesService } from './certificates/certificates.service';

@Module({
  controllers: [InvestorsController, CertificatesController],
  providers: [InvestorsService, CertificatesService],
})
export class IssuanceModule {}
