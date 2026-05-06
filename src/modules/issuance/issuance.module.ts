import { Module } from '@nestjs/common';
import { InvestorsController } from './investors/investors.controller';
import { InvestorsService } from './investors/investors.service';
import { CertificatesController } from './certificates/certificates.controller';
import { CertificatesService } from './certificates/certificates.service';
import { SweepController } from './sweep/sweep.controller';
import { SweepService } from './sweep/sweep.service';

@Module({
  controllers: [InvestorsController, CertificatesController, SweepController],
  providers: [InvestorsService, CertificatesService, SweepService],
})
export class IssuanceModule {}
