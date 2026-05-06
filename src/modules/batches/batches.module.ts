import { Module } from '@nestjs/common';
import { BatchesController } from './batches.controller';
import { BatchesService } from './batches.service';
import { IngestionService } from './ingestion.service';
import { ExcelParserService } from './excel-parser.service';
import { StorageService } from './storage.service';

@Module({
  controllers: [BatchesController],
  providers: [BatchesService, IngestionService, ExcelParserService, StorageService],
})
export class BatchesModule {}
