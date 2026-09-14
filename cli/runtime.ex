# A disposable distribution client. All target operations are OTP read-only queries.
defmodule Codeflow.Runtime do
  def rpc(node, mod, fun, args), do: :rpc.call(node, mod, fun, args, 1_000)

  def source(node, module) when is_atom(module) and not is_nil(module) do
    case rpc(node, module, :module_info, [:compile]) do
      info when is_list(info) ->
        case Keyword.get(info, :source) do
          source when is_list(source) -> List.to_string(source)
          source when is_binary(source) -> source
          _ -> nil
        end
      _ -> nil
    end
  end
  def source(_, _), do: nil

  def walk(node, pid, parent, application, kind, modules, depth, state, limit, max_depth) do
    key = inspect(pid)
    cond do
      Map.has_key?(state.processes, key) -> state
      map_size(state.processes) >= limit -> %{state | truncated: true}
      true ->
        info = rpc(node, :erlang, :process_info, [pid, [:registered_name, :initial_call, :memory, :message_queue_len, :reductions, :status]])
        # Only :undefined confirms that this PID has exited. An RPC failure
        # (including timeout or node loss) cannot establish process liveness.
        {info, observation_status} = case info do
          info when is_list(info) -> {info, "ready"}
          :undefined -> {[], "exited"}
          _ -> {[], "unavailable"}
        end
        module = case modules do
          [m | _] when is_atom(m) -> m
          _ -> case Keyword.get(info, :initial_call) do
            {m, _, _} when m not in [:proc_lib, :erlang] -> m
            _ -> nil
          end
        end
        {source_path, sources} = case Map.fetch(state.sources, module) do
          {:ok, path} -> {path, state.sources}
          :error -> path = source(node, module); {path, Map.put(state.sources, module, path)}
        end
        name = Keyword.get(info, :registered_name)
        label = if is_atom(name) and not is_nil(name), do: Atom.to_string(name), else: key
        child_result = if kind == :supervisor and depth < max_depth do
          case rpc(node, :supervisor, :which_children, [pid]) do
            children when is_list(children) -> {:ok, Enum.filter(children, fn {_, child, _, _} -> is_pid(child) end)}
            _ -> {:unavailable, []}
          end
        else
          {if(kind == :supervisor, do: :limited, else: :ok), []}
        end
        {children_status, children} = child_result
        entry = %{id: key, pid: key, parentId: parent, application: application, label: label,
          observationStatus: observation_status,
          type: Atom.to_string(kind), module: if(module, do: Atom.to_string(module), else: nil),
          source: source_path, childrenStatus: Atom.to_string(children_status), children: Enum.map(children, fn {_, child, _, _} -> inspect(child) end),
          metrics: %{memory: Keyword.get(info, :memory), messageQueueLength: Keyword.get(info, :message_queue_len),
            reductions: Keyword.get(info, :reductions), status: to_string(Keyword.get(info, :status, observation_status))}}
        state = %{state | processes: Map.put(state.processes, key, entry), sources: sources,
          truncated: state.truncated or (kind == :supervisor and depth >= max_depth)}
        Enum.reduce(children, state, fn {_, child, type, mods}, acc ->
          walk(node, child, key, application, type, mods, depth + 1, acc, limit, max_depth)
        end)
    end
  end

  def process_inventory(node) do
    case rpc(node, :erlang, :processes, []) do
      pids when is_list(pids) -> {"ready", pids}
      _ -> {"unavailable", []}
    end
  end

  def run do
    target = System.fetch_env!("CODEFLOW_RUNTIME_NODE") |> String.to_atom()
    mode = if System.get_env("CODEFLOW_RUNTIME_NAMES") == "longnames", do: :longnames, else: :shortnames
    [_name, host] = String.split(Atom.to_string(target), "@", parts: 2)
    own = String.to_atom("codeflow_#{System.pid()}_#{System.unique_integer([:positive])}@#{host}")
    {:ok, _} = Node.start(own, mode)
    if cookie = System.get_env("CODEFLOW_RUNTIME_COOKIE"), do: Node.set_cookie(String.to_atom(cookie))
    if Node.connect(target) != true, do: raise("Target node unavailable")
    limit = System.fetch_env!("CODEFLOW_RUNTIME_LIMIT") |> String.to_integer()
    max_depth = System.fetch_env!("CODEFLOW_RUNTIME_DEPTH") |> String.to_integer()
    apps = case rpc(target, :application, :which_applications, []) do
      apps when is_list(apps) -> Enum.sort(apps)
      _ -> raise("Applications unavailable")
    end
    initial = %{processes: %{}, sources: %{}, truncated: false}
    {applications, state} = Enum.map_reduce(apps, initial, fn {app, description, version}, state ->
      master = rpc(target, :application_controller, :get_master, [app])
      root = if is_pid(master), do: rpc(target, :application_master, :get_child, [master]), else: nil
      {pid, module} = case root do
        {pid, module} when is_pid(pid) -> {pid, module}
        _ -> {nil, nil}
      end
      state = if pid, do: walk(target, pid, nil, Atom.to_string(app), :supervisor, [module], 0, state, limit, max_depth), else: state
      {%{name: Atom.to_string(app), description: to_string(description), version: to_string(version), rootId: if(pid, do: inspect(pid), else: nil)}, state}
    end)
    # Include unsupervised processes too; their callback identity may be unknown.
    {inventory_status, pids} = process_inventory(target)
    state = Enum.reduce(pids, state, fn pid, state -> walk(target, pid, nil, nil, :process, [], 0, state, limit, max_depth) end)
    processes = Map.values(state.processes) |> Enum.sort_by(& &1.id)
    IO.puts("CODEFLOW_RUNTIME:" <> JSON.encode!(%{applications: applications, processes: processes, processInventoryStatus: inventory_status, truncated: state.truncated}))
  end
end
