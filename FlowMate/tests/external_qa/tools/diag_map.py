"""DIAGNOSTIC: the replacements that map FlowJo's sanitised channel name back to the FCS name in
every parameter reference of a workspace (not in population names). Prints them as JSON."""
import json, sys
a, b = sys.argv[1], sys.argv[2]          # e.g. LIVE_DEAD  LIVE/DEAD
reps = []
for attr in ['data-type:name="', 'data-type:parameter="', 'userProvidedCompInfix="', 'value="']:
    for pre in ['', 'Comp-']:
        reps.append([attr + pre + a, attr + pre + b])
reps.append([',' + a, ',' + b])          # inside the $SPILLOVER keyword value
print(json.dumps(reps))
