import re


def fixup(scripts):
    for req, script in scripts:
        fixup_script(script)


HEADER = """\
#!/usr/bin/env python
import os, site
here = os.path.dirname(os.path.abspath(__file__))
site.addsitedir(os.path.join(here, 'vendor'))
site.addsitedir(os.path.join(here, 'vendor-binary'))

## Here is the normal script:
"""

TEMPLATE = HEADER + """
__CONTENT__
"""

future_re = re.compile(r'^from\s+__future__')


def fixup_script(script):
    with open(script) as fp:
        first = fp.readline()
        if not first.startswith("#!"):
            # Not really a script
            return
        content = fp.read()
    content = TEMPLATE.replace('__CONTENT__', content)
    if 'from __future__' in content:
        # Header won't work, skip it
        return
    with open(script, 'w') as fp:
        fp.write(content)
