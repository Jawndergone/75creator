import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pygtylmlhpfubxpdlhrp.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB5Z3R5bG1saHBmdWJ4cGRsaHJwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk0NzA2MTksImV4cCI6MjA4NTA0NjYxOX0.8uZAY_fQNyVKHJD2Emc-5n_LOm_YM5xfdxuVCSkHfJs';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
