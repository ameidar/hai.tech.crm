import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from '../docs/openapi.js';

const router = Router();

/**
 * Swagger UI options
 */
const swaggerUiOptions = {
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info { margin-bottom: 20px }
    .swagger-ui .info .title { font-size: 2em }
  `,
  customSiteTitle: 'HaiTech CRM API Docs',
  customfavIcon: '/favicon.ico',
};

/**
 * @route   GET /api/v1/docs
 * @desc    Swagger UI documentation
 * @access  Public
 */
router.use('/', swaggerUi.serve);
router.get('/', swaggerUi.setup(openApiSpec, swaggerUiOptions));

/**
 * @route   GET /api/v1/docs/json
 * @desc    OpenAPI JSON spec
 * @access  Public
 */
router.get('/json', (_req, res) => {
  res.json(openApiSpec);
});

export default router;
