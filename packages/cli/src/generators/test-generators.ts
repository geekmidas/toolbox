import { CronGenerator } from './CronGenerator';
import { EndpointGenerator } from './EndpointGenerator';
import { FunctionGenerator } from './FunctionGenerator';
import type { BuildContext } from '../build/types';

async function testGenerators() {
  const logger = console;
  
  // Create a mock build context
  const context: BuildContext = {
    envParserPath: './env',
    envParserImportPattern: 'envParser',
    loggerPath: './logger',
    loggerImportPattern: 'logger',
  };
  
  // Initialize generators
  const endpointGen = new EndpointGenerator();
  const functionGen = new FunctionGenerator();
  const cronGen = new CronGenerator();
  
  logger.log('✓ All generators initialized successfully');
  
  // Test loading
  try {
    const endpoints = await endpointGen.load('./src/endpoints/**/*.ts');
    logger.log(`✓ Loaded ${endpoints.length} endpoints`);
    
    const functions = await functionGen.load('./src/functions/**/*.ts');
    logger.log(`✓ Loaded ${functions.length} functions`);
    
    const crons = await cronGen.load('./src/crons/**/*.ts');
    logger.log(`✓ Loaded ${crons.length} crons`);
    
  } catch (error) {
    logger.error('Error during loading:', error);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  testGenerators();
}