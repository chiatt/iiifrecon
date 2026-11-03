import re
from django_hosts import patterns, host

host_patterns = patterns(
    "",
    host(re.sub(r"_", r"-", r"iiifrecon"), "iiifrecon.urls", name="iiifrecon"),
)
