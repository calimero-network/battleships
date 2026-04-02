import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

/**
 * Legacy home page — redirects to the lobby-first flow.
 *
 * All group selection, lobby entry, and match management now live in
 * MatchPage (/lobby). This page exists only so old bookmarks and links
 * to /home still land somewhere sensible.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useMero();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/lobby', { replace: true });
    } else {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  return null;
}
