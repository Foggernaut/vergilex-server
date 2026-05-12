import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { createFavorite, deleteFavorite, listFavorites } from './favorites.controller.js';

export const favoritesRouter = Router();

favoritesRouter.use(requireAuth);
favoritesRouter.get('/', listFavorites);
favoritesRouter.post('/', createFavorite);
favoritesRouter.delete('/:id', deleteFavorite);
