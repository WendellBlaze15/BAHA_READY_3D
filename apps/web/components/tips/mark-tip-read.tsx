'use client';

import { useEffect } from 'react';
import { getSupabaseBrowser } from '@/lib/supabase/client';

/** Marks an unlocked tip as read (continuity: read on phone → shown read on desktop). */
export function MarkTipRead({ tipId }: { tipId: string }) {
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      await supabase
        .from('player_tips')
        .update({ read_at: new Date().toISOString() })
        .eq('tip_id', tipId)
        .is('read_at', null);
    })();
  }, [tipId]);
  return null;
}
