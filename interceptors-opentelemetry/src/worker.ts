import { DefaultLogger, Worker, Runtime, defaultSinks } from '@temporalio/worker';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  OpenTelemetryActivityInboundInterceptor,
  makeWorkflowExporter,
} from '@temporalio/interceptors-opentelemetry/lib/worker';
import * as activities from './activities';

import * as Sentry from '@sentry/node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { SentrySpanProcessor, SentryPropagator } from '@sentry/opentelemetry-node';

async function main() {
  Sentry.init({
    dsn: '', // not needed to see debug logs
    environment: 'development',
    tracesSampleRate: 1.0,
    instrumenter: 'otel',
    debug: true,
  });

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'interceptors-sample-worker',
  });
  // Export spans to console for simplicity
  // const exporter = new ConsoleSpanExporter();
  const exporter = new OTLPTraceExporter();

  const otel = new NodeSDK({
    traceExporter: exporter,
    resource,
    spanProcessor: new SentrySpanProcessor(),
    textMapPropagator: new SentryPropagator(),
  });
  await otel.start();

  // Silence the Worker logs to better see the span output in this sample
  Runtime.install({ logger: new DefaultLogger('WARN') });

  const worker = await Worker.create({
    workflowsPath: require.resolve('./workflows'),
    activities,
    taskQueue: 'interceptors-opentelemetry-example',
    sinks: {
      ...defaultSinks,
      exporter: makeWorkflowExporter(exporter, resource),
    },
    // Registers opentelemetry interceptors for Workflow and Activity calls
    interceptors: {
      // example contains both workflow and interceptors
      workflowModules: [require.resolve('./workflows')],
      activityInbound: [(ctx) => new OpenTelemetryActivityInboundInterceptor(ctx)],
    },
    // Set to true to get SDK traces too
    // See also the instrumentation sample on how to get traces out of Rust Core
    enableSDKTracing: false,
  });
  try {
    await worker.run();
  } finally {
    await otel.shutdown();
  }
}

main().then(
  () => void process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
