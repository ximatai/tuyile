CREATE INDEX planning_jobs_project_history ON planning_jobs(workspace_id,project_id,created_at DESC,id) WHERE NOT archived;
CREATE INDEX planning_jobs_user_created ON planning_jobs(user_id,created_at);
