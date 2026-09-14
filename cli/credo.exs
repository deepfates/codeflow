Mix.start()
[root] = System.argv()
# Use the inspected project's dependency and load paths when it provides Credo,
# including its plugins. A missing project tool is supplied by Mix.install's
# isolated cache; the inspected project's mix.exs and lockfile are not changed.
mode = Mix.Project.in_project(:codeflow_assessment, root, fn _ ->
  if Map.has_key?(Mix.Project.deps_paths(), :credo) do
    Mix.Task.run("loadpaths")
    Credo.CLI.main(["--format", "json"])
    :project
  else
    :standalone
  end
end)
if mode == :standalone do
  Mix.install([{:credo, "1.7.19"}])
  Credo.CLI.main(["--format", "json", root])
end
