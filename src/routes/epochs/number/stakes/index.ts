import { getSchemaForEndpoint } from '@blockfrost/openapi';
import { isUnpaged } from '../../../../utils/routes.js';
import { toJSONStream } from '../../../../utils/string-utils.js';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { SQLQuery } from '../../../../sql/index.js';
import * as QueryTypes from '../../../../types/queries/epochs.js';
import * as ResponseTypes from '../../../../types/responses/epochs.js';
import { getDbSync, gracefulRelease } from '../../../../utils/database.js';
import { handle400Custom, handle404 } from '../../../../utils/error-handler.js';
import { validatePositiveInRangeSignedInt } from '../../../../utils/validation.js';

async function route(fastify: FastifyInstance) {
  fastify.route({
    url: '/epochs/:number/stakes',
    method: 'GET',
    schema: getSchemaForEndpoint('/epochs/{number}/stakes'),
    handler: async (request: FastifyRequest<QueryTypes.RequestStakeParameters>, reply) => {
      const clientDbSync = await getDbSync(fastify);

      try {
        if (!validatePositiveInRangeSignedInt(request.params.number)) {
          gracefulRelease(clientDbSync);
          return handle400Custom(reply, 'Missing, out of range or malformed epoch_number.');
        }

        const query404 = await clientDbSync.query<QueryTypes.ResultFound>(
          SQLQuery.get('epochs_404'),
          [request.params.number],
        );

        if (query404.rows.length === 0) {
          gracefulRelease(clientDbSync);
          return handle404(reply);
        }

        const unpaged = isUnpaged(request);
        const { rows }: { rows: ResponseTypes.EpochStakes } = unpaged
          ? await clientDbSync.query<QueryTypes.EpochStake>(
              SQLQuery.get('epochs_number_stakes_unpaged'),
              [request.params.number],
            )
          : await clientDbSync.query<QueryTypes.EpochStake>(SQLQuery.get('epochs_number_stakes'), [
              request.params.number,
              request.query.count,
              request.query.page,
            ]);

        gracefulRelease(clientDbSync);

        if (rows.length === 0) {
          return reply.send([]);
        }

        if (unpaged) {
          // Use of Reply.raw functions is at your own risk as you are skipping all the Fastify logic of handling the HTTP response
          // https://www.fastify.io/docs/latest/Reference/Reply/#raw
          reply.raw.writeHead(200, { 'Content-Type': 'application/json' });
          await toJSONStream(rows, reply.raw);
          return reply;
        } else {
          return reply.send(rows);
        }
      } catch (error) {
        gracefulRelease(clientDbSync);
        throw error;
      }
    },
  });
}

export default route;
